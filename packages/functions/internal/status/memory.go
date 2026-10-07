package status

import (
	"context"
	"sync"
)

type Memory struct {
	mu      sync.Mutex
	records map[string]Record
}

func NewMemory() *Memory {
	return &Memory{records: map[string]Record{}}
}

func (m *Memory) Create(_ context.Context, record Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.records[record.JobID]; ok {
		return ErrExists
	}
	m.records[record.JobID] = record
	return nil
}

func (m *Memory) Get(_ context.Context, jobID string) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, ok := m.records[jobID]
	if !ok {
		return Record{}, ErrNotFound
	}
	return record, nil
}

func (m *Memory) Update(_ context.Context, record Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.records[record.JobID]; !ok {
		return ErrNotFound
	}
	m.records[record.JobID] = record
	return nil
}
