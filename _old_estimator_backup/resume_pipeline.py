import sys
import os
import json
import sqlite3
from langgraph.checkpoint.sqlite import SqliteSaver

# Setup SqliteSaver before importing graph to match connection
DB_PATH = os.path.dirname(__file__) + "/checkpoints.sqlite"
conn = sqlite3.connect(DB_PATH, check_same_thread=False)

from langgraph_orchestrator import graph, EstimatorState

def resume_pipeline(thread_id: str = "thread_1", approve: bool = True):
    config = {"configurable": {"thread_id": thread_id}}
    
    # Get the current state
    current_state = graph.get_state(config)
    
    if not current_state or not current_state.next:
        print("No paused pipeline found for this thread or graph is already finished.")
        return
        
    print(f"Resuming graph from node: {current_state.next}")
    
    if approve:
        print("Human approved the BOM. Continuing to pricing...")
        # Update the state to indicate human approval
        graph.update_state(config, {"human_approved": True}, as_node="human_review")
    else:
        print("Human rejected the BOM. (In a full implementation, this might route back to Electrical)")
        return
        
    # Resume execution with None since we updated the state directly
    result = graph.invoke(None, config=config)
    
    print("\n--- FINAL ESTIMATE ---")
    print(f"Total Cost: ${result.get('total_cost', 0.0)}")
    print(f"BOM exported to bom_export.csv")

if __name__ == "__main__":
    resume_pipeline()
