FROM node:20-alpine

# Install ZeroMQ native library
RUN apk add --no-cache \
    zeromq \
    zeromq-dev \
    python3 \
    make \
    g++

# Create non-root user
RUN addgroup -g 1001 -S zeromq && \
    adduser -u 1001 -S zeromq -G zeromq

# Create app directory
WORKDIR /app

# Install zeromq npm package
RUN npm install zeromq@6

# Copy proxy script
COPY proxy.js .

# Change ownership to non-root user
RUN chown -R zeromq:zeromq /app

# Switch to non-root user
USER zeromq

# Expose ZeroMQ proxy ports
EXPOSE 5555 5556

# Run the ZeroMQ proxy
CMD ["node", "proxy.js"]
