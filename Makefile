.PHONY: up down logs migrate server tidy ios-gen

up:
	docker compose up -d postgres minio minio-init

down:
	docker compose down

logs:
	docker compose logs -f postgres minio

migrate:
	cd server && go run ./cmd/api -migrate-only

server:
	cd server && go run ./cmd/api

tidy:
	cd server && go mod tidy

test:
	cd server && go test ./...
