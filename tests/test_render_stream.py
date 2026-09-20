"""Actual HTTP framing tests; fake native work avoids touching any Resolve project."""
import importlib.util
import http.client
import json
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stream_host',ROOT/'workflow-plugin/script-host.py')
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)

class StreamTests(unittest.TestCase):
    def exchange(self,dispatch):
        server=host.HTTPServer(('127.0.0.1',0),host.RpcHandler)
        server.token='test-token';server.resolve=object()
        worker=threading.Thread(target=server.serve_forever,daemon=True)
        worker.start()
        client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
        try:
            with patch.object(host,'dispatch',dispatch):
                client.request('POST','/rpc',json.dumps({'action':'render','args':{'job':{'document':{'lines':[{},{}]}}}}),{'X-AMLL-Token':'test-token','Content-Type':'application/json'})
                response=client.getresponse();status=response.status;kind=response.getheader('Content-Type')
                frames=[json.loads(line) for line in response.read().decode('utf-8').splitlines()]
                return status,kind,frames
        finally:
            client.close();server.shutdown();server.server_close();worker.join()

    def test_progress_and_exactly_one_terminal_success(self):
        def render(resolve,action,args,progress=None):
            progress({'stage':'writing','completed':1,'total':2})
            return {'insertedCount':2}
        status,kind,frames=self.exchange(render)
        self.assertEqual(status,200);self.assertIn('application/x-ndjson',kind)
        self.assertEqual(frames[0]['type'],'progress')
        self.assertEqual(frames[1]['data']['completed'],1)
        self.assertEqual(frames[-1],{'ok':True,'data':{'insertedCount':2}})
        self.assertEqual(sum('ok' in x for x in frames),1)

    def test_failure_is_a_terminal_frame_not_a_second_http_response(self):
        def render(*args,**kwargs):raise host.HostError('native failed')
        status,kind,frames=self.exchange(render)
        self.assertEqual(status,200)
        self.assertEqual(frames[-1],{'ok':False,'error':'native failed'})

if __name__=='__main__':unittest.main()
