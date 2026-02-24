# Use an official Node.js environment
FROM node:18-bullseye

# Install Ghostscript for the Text-to-Outline tool
RUN apt-get update && apt-get install -y ghostscript

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy your server code
COPY . .

# Start the server
EXPOSE 3000
CMD ["node", "server.js"]