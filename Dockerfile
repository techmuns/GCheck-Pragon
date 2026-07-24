# Paragon pre-meeting research agent — production image.
# Uses the official Playwright base image so Chromium (for the PrivateCircle /
# CIBIL browser collectors) is already installed and version-matched.
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Install dependencies against the lockfile first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Chromium lives here in the Playwright base image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000

# next start honours PORT and binds 0.0.0.0.
CMD ["npm", "start"]
