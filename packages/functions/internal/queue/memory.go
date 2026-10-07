package queue

import (
	"context"
	"sync"
)

type Memory struct {
	mu       sync.Mutex
	messages []Message
	sent     []string
	deleted  []string
}

func NewMemory() *Memory {
	return &Memory{}
}

func (m *Memory) Send(_ context.Context, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, body)
	m.messages = append(m.messages, Message{Body: body, Receipt: body})
	return nil
}

func (m *Memory) Receive(context.Context) (Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.messages) == 0 {
		return Message{}, ErrEmpty
	}
	message := m.messages[0]
	m.messages = m.messages[1:]
	return message, nil
}

func (m *Memory) Delete(_ context.Context, receipt string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleted = append(m.deleted, receipt)
	return nil
}

func (m *Memory) Sent() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.sent))
	copy(out, m.sent)
	return out
}

func (m *Memory) Deleted() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.deleted))
	copy(out, m.deleted)
	return out
}
