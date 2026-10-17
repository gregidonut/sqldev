package api

import (
	"strings"
	"testing"
)

func TestValidRegistryID(t *testing.T) {
	accepted := []string{"1000", "1001", "123456789", "9223372036854775807"}
	rejected := map[string]string{
		"below the first value":  "999",
		"zero":                   "0",
		"one past the maximum":   "9223372036854775808",
		"twenty digits":          "10000000000000000000",
		"negative":               "-1000",
		"explicit plus":          "+1000",
		"leading zero":           "01000",
		"leading space":          " 1000",
		"trailing space":         "1000 ",
		"trailing newline":       "1000\n",
		"decimal":                "1000.0",
		"fraction":               "1000.5",
		"exponent":               "1e3",
		"hexadecimal":            "0x3e8",
		"digit separator":        "1_000",
		"non-ASCII digits":       "١٠٠٠",
		"suffix":                 "1000n",
		"empty":                  "",
		"words":                  "one thousand",
		"negative zero":          "-0",
		"far above the maximum":  strings.Repeat("9", 40),
		"full-width digits":      "１０００",
		"embedded NUL":           "10\x0000",
		"minus the first value":  "-999",
		"first value with comma": "1,000",
	}
	for _, id := range accepted {
		if !validRegistryID(id) {
			t.Errorf("validRegistryID(%q) = false, want true", id)
		}
	}
	for name, id := range rejected {
		if validRegistryID(id) {
			t.Errorf("%s: validRegistryID(%q) = true, want false", name, id)
		}
	}
}

func TestValidCopy(t *testing.T) {
	ok := AuthoritativeDialogCopy{Title: "Make “report.pdf” public?", Description: "d", ConfirmLabel: "Make public"}
	if !validCopy(ok) {
		t.Fatalf("validCopy(%+v) = false", ok)
	}

	withTitle := func(s string) AuthoritativeDialogCopy { c := ok; c.Title = s; return c }
	withDescription := func(s string) AuthoritativeDialogCopy { c := ok; c.Description = s; return c }
	withLabel := func(s string) AuthoritativeDialogCopy { c := ok; c.ConfirmLabel = s; return c }

	accepted := map[string]AuthoritativeDialogCopy{
		"one-character fields":                     {Title: "a", Description: "b", ConfirmLabel: "c"},
		"title at 200 code points":                 withTitle(strings.Repeat("t", 200)),
		"description at 2000 code points":          withDescription(strings.Repeat("d", 2000)),
		"label at 80 code points":                  withLabel(strings.Repeat("l", 80)),
		"astral title counted once":                withTitle(strings.Repeat("😀", 200)),
		"astral description counted once":          withDescription(strings.Repeat("😀", 2000)),
		"astral label counted once":                withLabel(strings.Repeat("😀", 80)),
		"markup-like text is only text":            withTitle(`<img src=x onerror="alert(1)"> &amp; {{targetLabel}} \ "`),
		"right-to-left text":                       withTitle("ملف تقرير"),
		"combining marks":                          withTitle("e\u0301"),
		"a zero-width space is not blank":          withTitle("\u200b"),
		"a byte-order mark is not blank":           withTitle("\ufeff"),
		"a blank between visible runes":            withTitle("a\u00a0b"),
		"surrounding blanks are preserved":         withTitle("  a  "),
		"a title mixing blanks and a visible rune": withTitle("\u3000\u2028x"),
	}
	rejected := map[string]AuthoritativeDialogCopy{
		"empty title":                     withTitle(""),
		"empty description":               withDescription(""),
		"empty label":                     withLabel(""),
		"space-only title":                withTitle("   "),
		"tab and newline only":            withDescription("\t\n\r\v\f"),
		"U+00A0 only":                     withLabel("\u00a0"),
		"U+0085 only":                     withTitle("\u0085"),
		"U+1680 only":                     withTitle("\u1680"),
		"U+2000 to U+200A only":           withTitle("\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"),
		"U+2028 and U+2029 only":          withTitle("\u2028\u2029"),
		"U+202F only":                     withTitle("\u202f"),
		"U+205F only":                     withTitle("\u205f"),
		"U+3000 only":                     withTitle("\u3000"),
		"title at 201 code points":        withTitle(strings.Repeat("t", 201)),
		"description at 2001 code points": withDescription(strings.Repeat("d", 2001)),
		"label at 81 code points":         withLabel(strings.Repeat("l", 81)),
		"astral title at 201":             withTitle(strings.Repeat("😀", 201)),
		"astral description at 2001":      withDescription(strings.Repeat("😀", 2001)),
		"astral label at 81":              withLabel(strings.Repeat("😀", 81)),
		"invalid UTF-8 title":             withTitle("a\xffb"),
		"invalid UTF-8 description":       withDescription("\xc3\x28"),
		"invalid UTF-8 label":             withLabel("ok\xe2\x82"),
		"a lone surrogate encoding":       withTitle("\xed\xa0\x80"),
		"zero value":                      {},
	}
	for name, c := range accepted {
		if !validCopy(c) {
			t.Errorf("%s: validCopy was false for %+v", name, shorten(c))
		}
	}
	for name, c := range rejected {
		if validCopy(c) {
			t.Errorf("%s: validCopy was true for %+v", name, shorten(c))
		}
	}
}

// shorten keeps failure output small when a field holds thousands of runes.
func shorten(c AuthoritativeDialogCopy) AuthoritativeDialogCopy {
	cut := func(s string) string {
		if len(s) > 40 {
			return s[:40] + "…"
		}
		return s
	}
	return AuthoritativeDialogCopy{Title: cut(c.Title), Description: cut(c.Description), ConfirmLabel: cut(c.ConfirmLabel)}
}

// The blank class is the Unicode White_Space property, spelled out by hand
// rather than taken from strings.TrimSpace, so the Go set matches the PostgreSQL
// helper and JavaScript's trim() exactly.
func TestBlankClassIsExactlyUnicodeWhiteSpace(t *testing.T) {
	blank := map[rune]bool{
		'\t': true, '\n': true, '\v': true, '\f': true, '\r': true, ' ': true, 0x85: true, 0xA0: true, 0x1680: true,
		0x2028: true, 0x2029: true, 0x202F: true, 0x205F: true, 0x3000: true,
	}
	for r := rune(0x2000); r <= 0x200A; r++ {
		blank[r] = true
	}
	for r := rune(0); r <= 0x3100; r++ {
		if isBlankRune(r) != blank[r] {
			t.Errorf("isBlankRune(U+%04X) = %v, want %v", r, isBlankRune(r), blank[r])
		}
	}
	// Characters that look empty but are outside the class.
	for _, r := range []rune{0x180E, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD, 0x061C, 0x200E, 0x200F} {
		if isBlankRune(r) {
			t.Errorf("isBlankRune(U+%04X) = true, want false", r)
		}
	}
}
