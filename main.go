package main

import (
  "log"
  "net/http"

  "github.com/gin-gonic/gin"
)

func main() {
  // Create a Gin router with default middleware (logger and recovery)
  r := gin.Default()

  // Define a simple GET endpoint
  r.GET("/ping", func(c *gin.Context) {
    // Return JSON response
    c.JSON(http.StatusOK, gin.H{
      "message": "pong",
    })
  })

  // Start server on port 8080 (default)
  // Server will listen on 0.0.0.0:8080 (localhost:8080 on Windows)
  if err := r.Run(":1111"); err != nil {
    log.Fatalf("failed to run server: %v", err)
  }
}
