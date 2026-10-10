package status

import (
	"regexp"
	"testing"
)

// reservedWords lists the DynamoDB reserved words this package's attributes
// can collide with. DynamoDB rejects a bare reserved word in any expression.
var reservedWords = []string{"owner", "status", "kind", "attempt"}

func TestProgressConditionAliasesReservedWords(t *testing.T) {
	t.Parallel()
	for _, word := range reservedWords {
		bare := regexp.MustCompile(`(^|[^#:\w])` + word + `\b`)
		if bare.MatchString(progressCondition) {
			t.Errorf("progressCondition uses reserved word %q without a #%s alias", word, word)
		}
	}
}
