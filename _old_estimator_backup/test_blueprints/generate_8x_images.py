import fitz
import os

def generate_cells(pdf_path, output_dir, page_num, grid_size=5, zoom=8.0):
    print(f"Opening PDF for Page {page_num}...")
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    
    w, h = page.rect.width, page.rect.height
    cell_w = w / grid_size
    cell_h = h / grid_size
    
    mat = fitz.Matrix(zoom, zoom)
    
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"Generating {grid_size}x{grid_size} grid at {zoom}x zoom for page {page_num}...")
    for row in range(grid_size):
        for col in range(grid_size):
            clip = fitz.Rect(col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h)
            try:
                pix = page.get_pixmap(matrix=mat, clip=clip)
                out_path = os.path.join(output_dir, f"page{page_num}_zoom{int(zoom)}x_r{row}_c{col}.jpg")
                pix.save(out_path, "jpg")
                print(f"  ✓ Saved {out_path} ({pix.width}x{pix.height}px)")
            except Exception as e:
                print(f"  ✗ Failed to save r{row}c{col}: {e}")
                
    doc.close()

if __name__ == "__main__":
    pdf_file = "LLL 10870 Bal Harbour Shops - IFB Set - 03.12.26.pdf"
    base_dir = "/Users/denysharbuzov/.openclaw/agents/profit_step/estimator/test_blueprints"
    
    if not os.path.exists(os.path.join(base_dir, pdf_file)):
        print("PDF not found!")
        exit(1)
        
    out_dir_p54 = os.path.join(base_dir, "page54_power_plan_8x")
    out_dir_p67 = os.path.join(base_dir, "page67_fa_plan_8x")
    
    generate_cells(os.path.join(base_dir, pdf_file), out_dir_p54, 54, grid_size=5, zoom=8.0)
    generate_cells(os.path.join(base_dir, pdf_file), out_dir_p67, 67, grid_size=5, zoom=8.0)
    
    print("\n✅ All 8x zoom cells generated successfully!")
