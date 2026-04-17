import os
import pandas as pd
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

# Setup Clients
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

def get_embedding(text):
    """Converts business description into a list of 1536 numbers."""
    response = openai_client.embeddings.create(
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding

def ingest_data():
    # 1. Read the CSV
    # Ensure your file is named 'sp500_with_descriptions.csv' in the same folder
    try:
        df = pd.read_csv('sp500_with_descriptions.csv')
    except FileNotFoundError:
        print("Error: 'sp500.csv' not found. Make sure the file is in this folder.")
        return

    for index, row in df.iterrows():
        ticker = row.get('ticker', 'Unknown')
        
        # 2. Data Cleaning: Handle 'nan' or empty descriptions
        description = str(row.get('description', ''))
        
        if not description or description.lower() == 'nan' or len(description) < 10:
            print(f"⚠️ Skipping {ticker}: Missing or invalid description.")
            continue

        print(f"🚀 Processing {ticker}...")
        
        try:
            # 3. Generate Embedding via OpenAI
            description_vector = get_embedding(description)
            
            # 4. Prepare data for Supabase
            # Note: Using .get() ensures the script doesn't crash if a column name is slightly different
            data = {
                "ticker": ticker,
                "security_name": row.get('Security'),
                "sector": row.get('GICS Sector'),
                "sub_industry": row.get('GICS Sub-Industry'),
                "description": description,
                "embedding": description_vector
            }
            
            # 5. Upsert into Supabase (Update if exists, Insert if new)
            supabase.table("companies").upsert(data).execute()
            
        except Exception as e:
            print(f"❌ Error processing {ticker}: {e}")

if __name__ == "__main__":
    print("--- Starting S&P 500 Ingestion ---")
    ingest_data()
    print("--- Ingestion Complete! ---")