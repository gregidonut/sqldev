package prompt

import (
	"bytes"
	"strings"
	"testing"
)

func TestConfirmYes(t *testing.T) {
	for _, in := range []string{"y\n", "Y\n", "yes\n", "YES\n", " y \n"} {
		var out bytes.Buffer
		ok, err := Stdio{}.Confirm(strings.NewReader(in), &out, "Proceed?")
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Errorf("input %q should confirm", in)
		}
		if !strings.Contains(out.String(), "Proceed? [y/N]:") {
			t.Errorf("prompt not written: %q", out.String())
		}
	}
}

func TestConfirmNo(t *testing.T) {
	for _, in := range []string{"n\n", "no\n", "\n", "x\n", ""} {
		var out bytes.Buffer
		ok, err := Stdio{}.Confirm(strings.NewReader(in), &out, "Proceed?")
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			t.Errorf("input %q should not confirm", in)
		}
	}
}
