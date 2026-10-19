# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so Docker can cache this layer
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Vite builds to /app/dist (Create React App would use /app/build instead)
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80