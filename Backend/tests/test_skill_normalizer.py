from app.services.skill_normalizer import skill_normalizer


def test_normalize_skill_synonyms():
    assert skill_normalizer.normalize_skill("js") == "JavaScript"
    assert skill_normalizer.normalize_skill("k8s") == "Kubernetes"
    assert skill_normalizer.normalize_skill("py") == "Python"
    assert skill_normalizer.normalize_skill("postgres") == "PostgreSQL"


def test_normalize_skills_list():
    raw = ["JS", "JavaScript", "k8s", "Docker", "js"]
    normalized = skill_normalizer.normalize_skills(raw)
    assert normalized == ["JavaScript", "Kubernetes", "Docker"]
