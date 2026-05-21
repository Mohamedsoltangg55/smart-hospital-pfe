FROM node:18-alpine

WORKDIR /app

# 1. Copy just the dependency list first
COPY package*.json ./

# 2. Install the tools PERMANENTLY inside the image
RUN npm install

# 3. Copy the rest of the code
COPY . .

# 4. Start the app
CMD ["npm", "run", "dev"]