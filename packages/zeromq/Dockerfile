FROM node:20-alpine

# Install ZeroMQ native library
RUN apk add --no-cache \
    zeromq \
    zeromq-dev \
    python3 \
    make \
    g++

# Create app directory
WORKDIR /app

# Install zeromq npm package
RUN npm install zeromq@6

# Copy proxy script
COPY proxy.js .

# Expose ZeroMQ proxy ports
EXPOSE 5555 5556

# Run the ZeroMQ proxy
CMD ["node", "proxy.js"]
