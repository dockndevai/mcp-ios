# Build and run the MCP server over stdio. Used by Glama's automated check
# (the server only needs to start and answer an introspection request).
#
# Note: actually DRIVING an iPhone needs a Mac with Xcode, a signed
# WebDriverAgent, and a tethered device — none of which exist in a Linux
# container. This image is for the registry's start-up/introspection check only.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm install && npm run build
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/index.js"]
