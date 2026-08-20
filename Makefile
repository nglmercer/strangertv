.PHONY: dev build start check test e2e smoke backup loadtest docker docker-full ci

dev:
	npm run dev

build:
	npm run build
	cd rust && cargo build --release

start:
	./rust/target/release/stranger-server

check:
	npm run check
	npm run check:generated
	cd rust && cargo clippy --all-targets -- -D warnings

test:
	npm test
	cd rust && cargo test

e2e:
	npm run test:e2e

smoke:
	npm run smoke

backup:
	npm run backup

loadtest:
	npm run loadtest -- --clients=30 --seconds=15

docker:
	docker compose up --build -d

docker-turn:
	docker compose --profile turn up --build -d

ci:
	npm run test:all
