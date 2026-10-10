package devstack

import "testing"

func TestAssertLocalStage(t *testing.T) {
	for _, ok := range []string{"dev", "local", "development"} {
		if err := AssertLocalStage(ok); err != nil {
			t.Errorf("stage %q should be allowed: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "staging", "prod", "production", "Production", "preprod", "myprod"} {
		if err := AssertLocalStage(bad); err == nil {
			t.Errorf("stage %q should be refused", bad)
		}
	}
}
