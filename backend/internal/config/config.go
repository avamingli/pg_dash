package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	PGDSN         string
	Port          int
	AdminUser     string
	AdminPassword string
	JWTSecret     string
}

func Load() (*Config, error) {
	viper.SetDefault("PORT", 4000)
	viper.SetDefault("PG_DSN", "")
	viper.SetDefault("ADMIN_USER", "")
	viper.SetDefault("ADMIN_PASSWORD", "")
	viper.SetDefault("JWT_SECRET", "")

	viper.AutomaticEnv()

	cfg := &Config{
		PGDSN:         viper.GetString("PG_DSN"),
		Port:          viper.GetInt("PORT"),
		AdminUser:     viper.GetString("ADMIN_USER"),
		AdminPassword: viper.GetString("ADMIN_PASSWORD"),
		JWTSecret:     viper.GetString("JWT_SECRET"),
	}

	if cfg.PGDSN == "" {
		return nil, fmt.Errorf("Load: PG_DSN environment variable is required")
	}

	return cfg, nil
}

// AuthEnabled returns true if both ADMIN_USER and ADMIN_PASSWORD are set.
func (c *Config) AuthEnabled() bool {
	return c.AdminUser != "" && c.AdminPassword != ""
}
