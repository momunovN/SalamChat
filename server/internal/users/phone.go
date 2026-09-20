package users

import "samal.dev/server/internal/auth"

func normalizePhone(raw string) (string, bool) {
	return auth.NormalizePhone(raw)
}
