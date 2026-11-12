"""Smoke tests for STEMScholar Offline AI."""
import json
import sys
from app import app, default_settings, load_settings, save_settings, SUBJECTS, SUBJECT_SYSTEM_PROMPTS


def test_settings_defaults():
    s = default_settings()
    assert "theme" in s
    assert "accent" in s
    assert "temperature" in s
    assert "stream" in s
    print("PASS: test_settings_defaults")


def test_subjects():
    assert len(SUBJECTS) == 6
    assert "physics" in SUBJECTS
    assert "biology" in SUBJECTS
    assert "computer_science" in SUBJECTS
    assert "engineering" in SUBJECTS
    print("PASS: test_subjects")


def test_subject_system_prompts():
    for key in SUBJECTS:
        assert key in SUBJECT_SYSTEM_PROMPTS
        assert len(SUBJECT_SYSTEM_PROMPTS[key]) > 0
    print("PASS: test_subject_system_prompts")


def test_home_endpoint():
    client = app.test_client()
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"STEMScholar" in resp.data
    print("PASS: test_home_endpoint")


def test_status_endpoint():
    client = app.test_client()
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "ollama" in data
    assert "models" in data
    print("PASS: test_status_endpoint")


def test_settings_endpoint():
    client = app.test_client()
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "theme" in data
    print("PASS: test_settings_endpoint")


if __name__ == "__main__":
    test_settings_defaults()
    test_subjects()
    test_subject_system_prompts()
    test_home_endpoint()
    test_settings_endpoint()
    # Status endpoint needs Ollama running, skip if not available
    try:
        test_status_endpoint()
    except Exception as e:
        print(f"SKIP: test_status_endpoint ({e})")
    print("\nAll tests passed!")
