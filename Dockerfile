# Bun 공식 이미지 사용
FROM oven/bun:1-alpine AS base

WORKDIR /app

# 의존성 설치를 위한 파일 복사
COPY package.json bun.lock ./
COPY prisma ./prisma/

# 의존성 설치
RUN bun install --frozen-lockfile

# Prisma 클라이언트 생성
RUN bunx prisma generate

# 소스 코드 복사
COPY . .

# 크론 작업 실행
CMD ["bun", "run", "src/index.ts"]

