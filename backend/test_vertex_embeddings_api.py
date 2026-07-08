import subprocess
import json
import urllib.request
import urllib.error
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

def get_gcloud_token():
    try:
        # Run gcloud auth print-access-token using subprocess
        result = subprocess.run(
            ['gcloud', 'auth', 'print-access-token'],
            capture_output=True,
            text=True,
            check=True,
            shell=True
        )
        return result.stdout.strip()
    except Exception as e:
        print(f"Error al obtener token de gcloud: {e}")
        return None

def main():
    print("=== Test de Embeddings con Vertex AI REST API (text-embedding-004) ===")
    token = get_gcloud_token()
    if not token:
        print("No se pudo obtener un token de acceso. Asegúrate de estar autenticado en gcloud.")
        return

    project_id = "auditoria-mintc"
    location = "us-central1"
    url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models/text-embedding-004:predict"
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Texto de prueba
    text = "Este es un texto de prueba para validar que la generación de embeddings funciona correctamente en Vertex AI."
    
    payload = {
        "instances": [
            { "content": text }
        ],
        "parameters": {
            "autoTruncate": True,
            "outputDimensionality": 768
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST'
    )

    try:
        print("Enviando petición POST a Vertex AI REST API...")
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode('utf-8')
            res_json = json.loads(res_body)
            
            # Extraer el embedding
            predictions = res_json.get("predictions", [])
            if predictions and "embeddings" in predictions[0] and "values" in predictions[0]["embeddings"]:
                values = predictions[0]["embeddings"]["values"]
                print("\n[ÉXITO] Se obtuvo el embedding correctamente!")
                print(f"Dimensiones del vector: {len(values)}")
                print(f"Primeros 10 valores: {values[:10]}")
            else:
                print("\n[ERROR] Estructura de respuesta inesperada:")
                print(json.dumps(res_json, indent=2))
    except urllib.error.HTTPError as e:
        print(f"\n[HTTP_ERROR] Código de estado: {e.code} - {e.reason}")
        try:
            err_body = e.read().decode('utf-8')
            print(f"Detalles del error: {err_body}")
        except Exception:
            pass
    except Exception as e:
        print(f"\n[ERROR] {e}")

if __name__ == '__main__':
    main()
