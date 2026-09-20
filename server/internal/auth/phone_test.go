package auth

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := map[string]string{
		"+996700123456":      "+996700123456",
		"996700123456":       "+996700123456",
		"0700123456":         "+996700123456",
		"00 996 700 123 456": "+996700123456",
		"+79001234567":       "+79001234567",
		"79001234567":        "+79001234567",
		"89001234567":        "+79001234567",
		"+8 900 123-45-67":   "+79001234567",
		"9001234567":         "+79001234567",
	}
	for in, want := range cases {
		got, ok := NormalizePhone(in)
		if !ok || got != want {
			t.Fatalf("%q -> %q ok=%v want %q", in, got, ok, want)
		}
	}
}
