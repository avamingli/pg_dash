package model

type ReplicationStatus struct {
	PID             int    `json:"pid"`
	UserName        string `json:"usename"`
	ApplicationName string `json:"application_name"`
	ClientAddr      string `json:"client_addr"`
	State           string `json:"state"`
	SentLSN         string `json:"sent_lsn"`
	WriteLSN        string `json:"write_lsn"`
	FlushLSN        string `json:"flush_lsn"`
	ReplayLSN       string `json:"replay_lsn"`
	WriteLag        string `json:"write_lag"`
	FlushLag        string `json:"flush_lag"`
	ReplayLag       string `json:"replay_lag"`
	SyncState       string `json:"sync_state"`
	SyncPriority    int    `json:"sync_priority"`
}

type ReplicationSlot struct {
	SlotName        string `json:"slot_name"`
	SlotType        string `json:"slot_type"`
	Active          bool   `json:"active"`
	RestartLSN      string `json:"restart_lsn"`
	ConfirmedFlush  string `json:"confirmed_flush_lsn"`
	WALStatus       string `json:"wal_status"`
}
