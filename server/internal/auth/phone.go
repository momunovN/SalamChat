package auth

import (
	"regexp"
	"strings"
	"unicode"
)

var e164 = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

// NormalizePhone accepts KG (+996, 996, 0XXXXXXXXX) and RU (+7, 7XXXXXXXXXX, 8XXXXXXXXXX, 9XXXXXXXXX).
func NormalizePhone(raw string) (string, bool) {
	var b strings.Builder
	for _, r := range raw {
		if unicode.IsDigit(r) || r == '+' {
			b.WriteRune(r)
		}
	}
	s := b.String()
	switch {
	case strings.HasPrefix(s, "00"):
		s = "+" + s[2:]
	}
	switch {
	case strings.HasPrefix(s, "+8") && len(s) == 12:
		s = "+7" + s[2:]
	case strings.HasPrefix(s, "+"):
		// already E.164-shaped
	case strings.HasPrefix(s, "996") && len(s) >= 12:
		s = "+" + s
	case strings.HasPrefix(s, "7") && len(s) == 11:
		s = "+" + s
	case strings.HasPrefix(s, "8") && len(s) == 11:
		s = "+7" + s[1:]
	case strings.HasPrefix(s, "9") && len(s) == 10:
		s = "+7" + s
	case strings.HasPrefix(s, "0") && len(s) == 10:
		s = "+996" + s[1:]
	default:
		if len(s) > 0 && s[0] != '+' {
			s = "+" + s
		}
	}
	if !e164.MatchString(s) {
		return "", false
	}
	return s, true
}

func DefaultDisplayName(phone string) string {
	if len(phone) < 4 {
		return "TooApp"
	}
	return "• " + phone[len(phone)-4:]
}
