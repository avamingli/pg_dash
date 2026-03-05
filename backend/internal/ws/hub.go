package ws

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

// SubscribeMsg is the JSON message clients send to set their subscription filter.
// Example: {"subscribe": ["pg", "system"]} or {"subscribe": ["all"]}
type SubscribeMsg struct {
	Subscribe []string `json:"subscribe"`
}

// Client represents a single WebSocket connection.
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	filter map[string]bool // which metric categories to receive
	mu     sync.RWMutex
}

// SetFilter updates the subscription filter for this client.
func (c *Client) SetFilter(categories []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.filter = make(map[string]bool, len(categories))
	for _, cat := range categories {
		c.filter[cat] = true
	}
}

// WantsCategory returns true if the client subscribed to this category
// or subscribed to "all" (or has no filter set = wants everything).
func (c *Client) WantsCategory(category string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.filter) == 0 {
		return true // no filter = receive all
	}
	if c.filter["all"] {
		return true
	}
	return c.filter[category]
}

// Hub maintains the set of active clients and broadcasts messages.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new WebSocket hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's event loop. Must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Info().Int("clients", len(h.clients)).Msg("WebSocket client connected")

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Info().Int("clients", len(h.clients)).Msg("WebSocket client disconnected")

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastFiltered sends a message to clients that want the given category.
// This allows sending PG-only or system-only data to subscribed clients.
func (h *Hub) BroadcastFiltered(msg []byte, category string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if !client.WantsCategory(category) {
			continue
		}
		select {
		case client.send <- msg:
		default:
			close(client.send)
			delete(h.clients, client)
		}
	}
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(msg []byte) {
	h.broadcast <- msg
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// RegisterClient upgrades an HTTP connection and registers it with the hub.
func (h *Hub) RegisterClient(conn *websocket.Conn) {
	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, 256),
	}
	h.register <- client
	go client.WritePump()
	go client.ReadPump()
}

// HandleClientMessage processes incoming messages from a client.
// Currently supports subscription filter messages.
func HandleClientMessage(client *Client, msg []byte) {
	var sub SubscribeMsg
	if err := json.Unmarshal(msg, &sub); err != nil {
		return // ignore non-JSON messages
	}
	if len(sub.Subscribe) > 0 {
		client.SetFilter(sub.Subscribe)
		log.Debug().Strs("subscribe", sub.Subscribe).Msg("client subscription updated")
	}
}
