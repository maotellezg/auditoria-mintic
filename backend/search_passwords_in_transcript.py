import json
import re

transcript_path = r"C:\Users\maote\.gemini\antigravity\brain\0ba720c4-70e7-4651-84e4-1d89eea3ba5d\.system_generated\logs\transcript.jsonl"

def main():
    print("=== Buscando contraseñas o credenciales en los logs del transcript ===")
    matches = []
    with open(transcript_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if any(term in line.lower() for term in ["pass", "contrase", "maotellezg"]):
                # Intenta buscar credenciales o fragmentos interesantes
                # No imprimimos toda la línea si es muy larga
                matches.append((line_num, line))
                
    print(f"Encontradas {len(matches)} líneas coincidentes.")
    for num, match in matches[:50]:
        # Encontrar texto con 'password' o 'key'
        try:
            obj = json.loads(match)
            content = obj.get("content", "")
            if isinstance(content, str) and content:
                # Buscar fragmentos con 'password' o 'contraseña'
                for line in content.split('\n'):
                    if any(term in line.lower() for term in ["pass", "contrase", "admin"]):
                        print(f"Línea {num}: {line.strip()[:150]}")
        except Exception:
            pass

if __name__ == "__main__":
    main()
