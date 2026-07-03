import firebase_admin
from firebase_admin import credentials, firestore
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

try:
    firebase_admin.initialize_app(options={
        'projectId': 'entrega-anla'
    })
    db = firestore.client()
    print("Conectado exitosamente a Firestore en proyecto 'entrega-anla'.")
    
    docs_ref = db.collection('documents')
    
    total = 0
    indexed_success = 0
    failed = 0
    pending = 0
    
    for doc in docs_ref.where('status', '==', 'Analizado').stream():
        total += 1
        data = doc.to_dict()
        val = data.get('indexed')
        if val is True:
            indexed_success += 1
        elif val == 'error':
            failed += 1
        else:
            pending += 1
            
    print("\n--- ESTADÍSTICAS DE INDEXACIÓN RAG ---")
    print(f"Total analizados elegibles: {total}")
    print(f"Indexados con éxito: {indexed_success}")
    print(f"Fallidos: {failed}")
    print(f"Pendientes: {pending}")
    if total > 0:
        print(f"Porcentaje completado: {round((indexed_success / total) * 100, 2)}%")
        
except Exception as e:
    print(f"Error: {e}")
