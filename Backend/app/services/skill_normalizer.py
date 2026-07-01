import json
import os
from typing import List


class SkillNormalizer:
    def __init__(self, synonyms_path: str = None):
        if synonyms_path is None:
            base_dir = os.path.dirname(os.path.dirname(__file__))
            synonyms_path = os.path.join(base_dir, "data", "skill_synonyms.json")
        self.synonyms_path = synonyms_path
        self.synonyms = {}
        self.load_synonyms()

    def load_synonyms(self):
        if os.path.exists(self.synonyms_path):
            try:
                with open(self.synonyms_path, "r", encoding="utf-8") as f:
                    self.synonyms = json.load(f)
            except Exception:
                self.synonyms = {}
        else:
            self.synonyms = {}

    def normalize_skill(self, skill: str) -> str:
        if not skill:
            return ""
        clean = skill.strip().lower()
        if clean in self.synonyms:
            return self.synonyms[clean]
        # Return title cased or original if not in synonym map
        return skill.strip()

    def normalize_skills(self, skills: List[str]) -> List[str]:
        if not skills:
            return []
        seen = set()
        normalized = []
        for s in skills:
            norm = self.normalize_skill(s)
            if norm and norm.lower() not in seen:
                seen.add(norm.lower())
                normalized.append(norm)
        return normalized


skill_normalizer = SkillNormalizer()
