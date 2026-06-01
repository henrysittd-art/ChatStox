# Stage 1: Build the static web files
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Generate the API config file from env
RUN node scripts/generate-api.js

# Export static files for web
RUN npx expo export --platform web

# Stage 2: Serve the static files via Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
