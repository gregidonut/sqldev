package host

import "testing"

func TestAssertDeployedStage(t *testing.T) {
	for _, stage := range []string{"", "dev"} {
		if err := AssertDeployedStage(stage); err == nil {
			t.Errorf("stage %q should be refused", stage)
		}
	}
	for _, stage := range []string{"staging", "production", "prod", "local"} {
		if err := AssertDeployedStage(stage); err != nil {
			t.Errorf("stage %q should be allowed, got %v", stage, err)
		}
	}
}

func TestHostName(t *testing.T) {
	if got := HostName("staging"); got != "sqldev-staging-supabase" {
		t.Errorf("HostName = %q", got)
	}
}

func TestSoleDataVolume(t *testing.T) {
	if _, err := soleDataVolume(Instance{InstanceID: "i-1"}); err == nil {
		t.Error("zero volumes should error")
	}
	if _, err := soleDataVolume(Instance{InstanceID: "i-1", DataVolumeIDs: []string{"vol-a", "vol-b"}}); err == nil {
		t.Error("two volumes should error")
	}
	got, err := soleDataVolume(Instance{InstanceID: "i-1", DataVolumeIDs: []string{"vol-a"}})
	if err != nil || got != "vol-a" {
		t.Errorf("got %q, %v", got, err)
	}
}
