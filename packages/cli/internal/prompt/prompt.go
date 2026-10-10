// Package prompt provides a small, injectable confirmation reader shared by the
// storage and dev reset commands so no command keeps a private prompt parser.
package prompt

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// Confirmer asks a yes/no question and reports whether the answer was yes.
type Confirmer interface {
	Confirm(in io.Reader, out io.Writer, message string) (bool, error)
}

// Stdio is the default Confirmer. It prints "<message> [y/N]: " and treats only
// "y"/"yes" (case-insensitive) as affirmative.
type Stdio struct{}

// Confirm implements Confirmer.
func (Stdio) Confirm(in io.Reader, out io.Writer, message string) (bool, error) {
	fmt.Fprintf(out, "%s [y/N]: ", message)
	reader := bufio.NewReader(in)
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes", nil
}
