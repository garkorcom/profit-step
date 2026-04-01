import os
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct
from langchain_openai import OpenAIEmbeddings

# Initialize Qdrant local memory/file client
QDRANT_PATH = os.path.join(os.path.dirname(__file__), "qdrant_data")
client = QdrantClient(path=QDRANT_PATH)

COLLECTION_NAME = "construction_prices"

def setup_rag():
    # Create collection if it doesn't exist
    collections = client.get_collections().collections
    if not any(c.name == COLLECTION_NAME for c in collections):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
        print(f"Collection '{COLLECTION_NAME}' created.")
    else:
        print(f"Collection '{COLLECTION_NAME}' already exists.")

    # Sample data to upload (Phase 8 PRO electrical materials + Plumbing)
    sample_materials = [
        # Wires
        {"id": 1, "name": "1.5 mm2 (14/2 AWG) Copper Wire - 100m", "price": 45.00, "category": "electrical"},
        {"id": 2, "name": "2.5 mm2 (12/2 AWG) Copper Wire - 100m", "price": 65.00, "category": "electrical"},
        {"id": 3, "name": "6.0 mm2 (10/2 AWG) Copper Wire - 100m", "price": 140.00, "category": "electrical"},
        {"id": 4, "name": "10.0 mm2 (8/3 AWG) Copper Wire - 100m", "price": 280.00, "category": "electrical"},
        # Breakers & RCBOs
        {"id": 5, "name": "16A Single-Pole Breaker", "price": 6.50, "category": "electrical"},
        {"id": 6, "name": "20A Single-Pole Breaker", "price": 7.00, "category": "electrical"},
        {"id": 7, "name": "40A Double-Pole Breaker", "price": 18.00, "category": "electrical"},
        {"id": 8, "name": "20A RCBO / GFCI Breaker (Wet Zone)", "price": 45.00, "category": "electrical"},
        # Panels
        {"id": 9, "name": "12-way Distribution Panel Enclosure", "price": 35.00, "category": "electrical"},
        {"id": 10, "name": "24-way Distribution Panel Enclosure", "price": 75.00, "category": "electrical"},
        {"id": 11, "name": "36-way Distribution Panel Enclosure", "price": 145.00, "category": "electrical"},
        # Devices
        {"id": 12, "name": "Standard Socket / Receptacle", "price": 2.50, "category": "electrical"},
        {"id": 13, "name": "Lighting Fixture / Switch", "price": 4.50, "category": "electrical"},
        {"id": 14, "name": "Appliance Junction Box", "price": 12.00, "category": "electrical"},
        # Plumbing materials
        {"id": 15, "name": "1/2 inch PEX Pipe - 100ft", "price": 35.00, "category": "plumbing"},
        {"id": 16, "name": "1-1/2 inch PVC Pipe - 10ft", "price": 8.50, "category": "plumbing"},
        {"id": 17, "name": "P-Trap Kit 1-1/2 inch", "price": 4.50, "category": "plumbing"},
        {"id": 18, "name": "Angle Stop Valve 1/2 x 3/8", "price": 7.20, "category": "plumbing"}
    ]

    try:
        embeddings = OpenAIEmbeddings()
        
        points = []
        for mat in sample_materials:
            # Create a combined text for vector embedding
            text_to_embed = f"{mat['name']} ({mat['category']})"
            vector = embeddings.embed_query(text_to_embed)
            
            points.append(
                PointStruct(
                    id=mat['id'],
                    vector=vector,
                    payload={"name": mat['name'], "price": mat['price'], "category": mat['category']}
                )
            )
        
        # Upload to Qdrant
        client.upsert(
            collection_name=COLLECTION_NAME,
            points=points
        )
        print("Sample materials uploaded successfully to Qdrant!")
        
    except Exception as e:
        print(f"Error generating embeddings or uploading to Qdrant. Make sure OPENAI_API_KEY is set. Error: {e}")

if __name__ == "__main__":
    setup_rag()
