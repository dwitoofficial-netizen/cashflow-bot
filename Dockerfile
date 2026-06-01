# Base image Node
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy semua file project
COPY . .

# Start bot
CMD ["npm", "start"]
