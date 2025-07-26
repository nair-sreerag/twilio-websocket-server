# Use the official Node.js runtime as the base image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and yarn.lock
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --production --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Create a non-root user
RUN useradd -r -u 1001 -g root nodeuser
RUN chown -R nodeuser:root /app
USER nodeuser

# Expose the port the app runs on
EXPOSE 8081

# Define the command to run the application
CMD ["yarn", "start"]