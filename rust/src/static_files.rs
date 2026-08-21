//! SPA static serving. Port of `server/static.ts`.
//!
//! Tries `publicDir` first, then `distDir`, then falls back to `index.html` so
//! client-side routes (including `/admin`) resolve. Path traversal outside the
//! root is refused rather than served.

use std::path::{Path, PathBuf};

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const NO_CACHE: &str = "no-cache";

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        Some("json") | Some("map") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("txt") => "text/plain; charset=utf-8",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[derive(Clone)]
pub struct StaticHandler {
    dist: PathBuf,
    public: Option<PathBuf>,
}

impl StaticHandler {
    pub fn new(dist_dir: &str, public_dir: Option<&str>) -> Self {
        Self {
            dist: PathBuf::from(dist_dir),
            public: public_dir.map(PathBuf::from),
        }
    }

    pub async fn serve(&self, request_path: &str) -> Option<Response> {
        if !self.dist.exists() && !self.public.as_ref().is_some_and(|p| p.exists()) {
            return None;
        }

        let mut rel = if request_path.is_empty() || request_path == "/" {
            "/index.html".to_string()
        } else {
            request_path.to_string()
        };
        // `/admin` is a client-side route, not a directory.
        if rel == "/admin" || rel.starts_with("/admin/") {
            rel = "/index.html".into();
        }

        if let Some(public) = &self.public {
            if public.exists() {
                match try_file(public, &rel).await {
                    FileResult::Found(res) => return Some(res),
                    FileResult::Forbidden => return Some(forbidden()),
                    FileResult::Missing => {}
                }
            }
        }
        if self.dist.exists() {
            match try_file(&self.dist, &rel).await {
                FileResult::Found(res) => return Some(res),
                FileResult::Forbidden => return Some(forbidden()),
                FileResult::Missing => {}
            }
        }

        // SPA fallback.
        let index = self.dist.join("index.html");
        match tokio::fs::read(&index).await {
            Ok(data) => Some(
                (
                    [
                        (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                        (header::CACHE_CONTROL, NO_CACHE),
                    ],
                    data,
                )
                    .into_response(),
            ),
            Err(_) => None,
        }
    }
}

enum FileResult {
    Found(Response),
    Forbidden,
    Missing,
}

fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "Forbidden").into_response()
}

async fn try_file(base: &Path, rel: &str) -> FileResult {
    let candidate = base.join(rel.trim_start_matches('/'));

    // Resolve `..` before comparing, so a traversal cannot escape the root.
    // `canonicalize` needs the file to exist, so fall back to a lexical check.
    let escaped = match (candidate.canonicalize(), base.canonicalize()) {
        (Ok(c), Ok(b)) => !c.starts_with(&b),
        _ => rel.split('/').any(|seg| seg == ".."),
    };
    if escaped {
        return FileResult::Forbidden;
    }

    let Ok(data) = tokio::fs::read(&candidate).await else {
        return FileResult::Missing;
    };

    let is_html = rel.ends_with(".html");
    let is_well_known =
        rel.contains(".well-known") || rel.ends_with(".txt") || rel.ends_with(".webmanifest");
    let cache = if is_html || is_well_known { NO_CACHE } else { IMMUTABLE };

    FileResult::Found(
        (
            [
                (header::CONTENT_TYPE, mime_for(&candidate)),
                (header::CACHE_CONTROL, cache),
            ],
            data,
        )
            .into_response(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_types_cover_the_build_output() {
        assert_eq!(mime_for(Path::new("a/b.js")), "text/javascript; charset=utf-8");
        assert_eq!(mime_for(Path::new("a/b.css")), "text/css; charset=utf-8");
        assert_eq!(mime_for(Path::new("a/b.woff2")), "font/woff2");
        assert_eq!(mime_for(Path::new("a/b.unknown")), "application/octet-stream");
        assert_eq!(mime_for(Path::new("noext")), "application/octet-stream");
    }

    #[tokio::test]
    async fn traversal_outside_the_root_is_refused() {
        let dir = std::env::temp_dir();
        match try_file(&dir, "/../../etc/passwd").await {
            FileResult::Forbidden => {}
            _ => panic!("path traversal must be refused"),
        }
    }
}
