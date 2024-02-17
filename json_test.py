# Simple class

import json

class JsonTest:
    data: str
    
    def __init__(self, data: str = ""):
        self.data = data

json_objects = [
    JsonTest("testing"),
    JsonTest("testing2"),
]

print(json.dumps(json_objects))

