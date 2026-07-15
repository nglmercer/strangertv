.PHONY: dev build start check test e2e smoke backup loadtest docker docker-full ci

dev:
	npm run dev

build:
	npm run build

start:
	npm start

check:
	npm run check

test:
	npm test

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

ci: check test build
	npm run test:e2e
