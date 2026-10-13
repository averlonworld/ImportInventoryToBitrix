# ============================================
# Bitrix24 Inventory Frontend (React + Vite) - Multi-stage Build
# ============================================

# Stage 1: Build the Vite bundle
FROM node:22-alpine AS build

WORKDIR /app

# The ARG must be declared INSIDE the stage. A global ARG (declared before the
# first FROM) is not in scope here, so `ENV VITE_API_URL=$VITE_API_URL` would
# expand to an empty string.
#
# The Vite config throws when VITE_API_URL is unset. The browser bundle calls
# the API relatively (`baseURL: '/api'`) and never reads import.meta.env, so
# this value only has to be non-empty.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:stable-alpine AS production

RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

