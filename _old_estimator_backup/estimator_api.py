from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sqlite3

# Import our LangGraph modules
from langgraph_orchestrator import run_pipeline, graph
from resume_pipeline import resume_pipeline

app = Flask(__name__)
CORS(app)  # Allow React to hit this API

# Ensure uploads directory exists
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.route('/api/estimate', methods=['POST'])
def estimate():
    """Legacy endpoint — accepts blueprint_path string and runs with sample data."""
    data = request.json
    blueprint_path = data.get('blueprint_path', 'plumbing_layout_P1.pdf')
    thread_id = data.get('thread_id', 'thread_1')
    
    try:
        # Run pipeline
        res, conf = run_pipeline(blueprint_path, thread_id=thread_id)
        current_state = graph.get_state(conf)
        
        # Check if the graph paused for human review
        if current_state and current_state.next:
            return jsonify({
                "status": "paused_for_review",
                "pending_bom": current_state.values.get("bom", []),
                "circuits": current_state.values.get("circuits", []),
                "panel_schedule": current_state.values.get("panel_schedule", []),
                "thread_id": thread_id,
                "blueprint_type": current_state.values.get("blueprint_type", "")
            })
        else:
            return jsonify({
                "status": "completed",
                "message": "Graph finished without pausing or was already done."
            })
            
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/upload-blueprint', methods=['POST'])
def upload_blueprint():
    """Phase 10: Upload PDF → Vision Parser → JSON 2.0 → LangGraph Pipeline."""
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file uploaded. Send a 'file' field."}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({"status": "error", "message": "Empty filename."}), 400
    
    thread_id = request.form.get('thread_id', f'thread_{int(__import__("time").time())}')
    
    # Save uploaded file
    filepath = os.path.join(UPLOAD_DIR, file.filename)
    file.save(filepath)
    print(f"📄 Saved upload: {filepath}")
    
    try:
        # Step 1: Parse blueprint with Vision Agent
        from blueprint_parser import parse_blueprint
        blueprint_json = parse_blueprint(filepath)
        
        # Step 2: Run through LangGraph pipeline with parsed JSON
        # Determine blueprint type from content (use "electrical" path for now)
        blueprint_path = f"electrical_{file.filename}"
        
        res, conf = run_pipeline(
            blueprint_path=blueprint_path,
            blueprint_json=blueprint_json,
            thread_id=thread_id
        )
        current_state = graph.get_state(conf)
        
        if current_state and current_state.next:
            return jsonify({
                "status": "paused_for_review",
                "pending_bom": current_state.values.get("bom", []),
                "circuits": current_state.values.get("circuits", []),
                "panel_schedule": current_state.values.get("panel_schedule", []),
                "blueprint_json": blueprint_json,  # Send parsed JSON back to UI
                "thread_id": thread_id,
                "blueprint_type": current_state.values.get("blueprint_type", "")
            })
        else:
            return jsonify({
                "status": "completed",
                "message": "Pipeline completed without review pause.",
                "blueprint_json": blueprint_json
            })
            
    except ImportError:
        return jsonify({
            "status": "error",
            "message": "blueprint_parser.py not found or PyMuPDF not installed. Run: pip install PyMuPDF"
        }), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/estimate/resume', methods=['POST'])
def resume():
    data = request.json
    thread_id = data.get('thread_id', 'thread_1')
    approve = data.get('approve', True)
    
    try:
        resume_pipeline(thread_id=thread_id, approve=approve)
        
        # Read final state to return the final cost
        conf = {"configurable": {"thread_id": thread_id}}
        final_state = graph.get_state(conf)
        
        total_cost = 0.0
        final_bom = []
        if final_state and final_state.values:
            total_cost = final_state.values.get("total_cost", 0.0)
            final_bom = final_state.values.get("bom", [])
            
        return jsonify({
            "status": "completed", 
            "message": "Pipeline finished and CSV exported.",
            "total_cost": total_cost,
            "bom": final_bom
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    # Run on port 8000
    app.run(port=8000, debug=True, host='0.0.0.0')
