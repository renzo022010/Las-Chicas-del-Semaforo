"""Pruebas del calculo de UFC por placa y del historial (foto, conteo, revision y UFC guardados juntos)."""
import csv,io,json,os,tempfile,time,unittest
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient
from app.main import create_app
from app.schemas.samples import UfcInput
from app.services.ufc import calcular_ufc,redondear

def fake_analysis(root,ident,count,age=0,analyzed_at=None):
    """Crea la carpeta que dejaria /analyze: foto original y resultado del modelo."""
    folder=root/ident;folder.mkdir(parents=True)
    Image.new('RGB',(800,600),(40,40,40)).save(folder/'foto_original.jpg')
    result=folder/'foto_resultado.json'
    body={'count':count,'image_size':{'width':800,'height':600},'detections':[]}
    if analyzed_at:body['analyzed_at']=analyzed_at
    result.write_text(json.dumps(body),encoding='utf-8')
    if age:os.utime(result,(time.time()-age,time.time()-age))
    return ident

A,B,C='a'*32,'b'*32,'c'*32

class ReportTests(unittest.TestCase):
    def test_two_significant_figures_and_log(self):
        self.assertEqual(redondear(46500),47000);self.assertEqual(redondear(1234.5),1200);self.assertEqual(redondear(0),0)
        r=calcular_ufc(UfcInput(dilutions=[{'exponent':2,'volume_ml':.1,'plate_a':{'count':45},'plate_b':{'count':48}}]))
        self.assertEqual(r['reported'],47000);self.assertAlmostEqual(r['log10'],4.67)
        self.assertEqual(r['rows'][0]['counts'],[45,48])

class HistoryApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.api=self.root/'api'
    def tearDown(self):self.tmp.cleanup()
    def client(self,key=None):
        return TestClient(create_app(output=self.api,samples_db=self.root/'m.db',use_hybrid=False,access_key=key))

    def test_ufc_uses_automatic_count_and_is_saved_next_to_photo(self):
        fake_analysis(self.api,A,45)
        with self.client() as c:
            body={'exponent':2,'volume_ml':.1,'duplicate_count':48,'sample':{'code':'M-001','sample_type':'Suelo','responsible':'Ana'}}
            r=c.post(f'/results/{A}/ufc',json=body);self.assertEqual(r.status_code,200,r.text)
            rec=r.json()
            self.assertEqual((rec['count'],rec['count_source'],rec['automatic_count']),(45,'automatico',45))
            self.assertAlmostEqual(rec['result']['value'],46500);self.assertEqual(rec['result']['unit'],'UFC/mL')
            self.assertTrue(rec['result']['in_range']);self.assertEqual(rec['result']['warnings'],[])
            saved=c.get(f'/results/{A}/ufc.json').json()
            self.assertEqual(saved['sample']['code'],'M-001');self.assertEqual(saved['result']['reported'],47000)
        log=(self.api/'historial.jsonl').read_text(encoding='utf-8').splitlines()
        self.assertEqual(len(log),1);self.assertEqual(json.loads(log[0])['analysis_id'],A)

    def test_reviewed_count_wins_and_log_keeps_every_save(self):
        fake_analysis(self.api,A,40)
        with self.client() as c:
            centers=[{'x':10+i,'y':10} for i in range(120)]
            self.assertEqual(c.post(f'/results/{A}/review',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'centers':centers}).status_code,200)
            first=c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':3,'volume_ml':1,'unit':'g'}).json()
            self.assertEqual((first['count'],first['count_source'],first['reviewed_count']),(120,'revisado',120))
            self.assertAlmostEqual(first['result']['value'],120000);self.assertEqual(first['result']['unit'],'UFC/g')
            self.assertTrue(any('una sola placa' in w for w in first['result']['warnings']))
            c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':2,'volume_ml':1,'unit':'g'})
            self.assertEqual(c.get(f'/results/{A}/ufc.json').json()['exponent'],2)
        self.assertEqual(len((self.api/'historial.jsonl').read_text(encoding='utf-8').splitlines()),2)

    def test_out_of_range_and_zero_counts_warn(self):
        fake_analysis(self.api,A,12);fake_analysis(self.api,B,0)
        with self.client() as c:
            low=c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1}).json()['result']
            self.assertFalse(low['in_range']);self.assertTrue(any('estimacion' in w for w in low['warnings']))
            zero=c.post(f'/results/{B}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1}).json()['result']
            self.assertEqual(zero['value'],0);self.assertAlmostEqual(zero['detection_limit'],100)

    def test_history_newest_first_with_and_without_ufc(self):
        fake_analysis(self.api,A,45,age=300);fake_analysis(self.api,B,80,age=100);fake_analysis(self.api,C,10)
        (self.api/'nota.txt').write_text('no es un analisis',encoding='utf-8')
        (self.api/('d'*32)).mkdir()  # carpeta sin resultado: se ignora
        with self.client() as c:
            c.post(f'/results/{B}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1,'sample':{'code':'M-002','sample_type':'Agua'}})
            items=c.get('/history').json()
            self.assertEqual([i['analysis_id'] for i in items],[C,B,A])
            self.assertIsNone(items[0]['ufc'])
            self.assertEqual(items[1]['ufc']['sample']['code'],'M-002');self.assertAlmostEqual(items[1]['ufc']['value'],8000)
            self.assertEqual(len(c.get('/history?limit=1').json()),1)
            text=c.get('/history/csv').content.decode('utf-8-sig')
            rows=list(csv.DictReader(io.StringIO(text)))
            self.assertEqual(len(rows),3)
            self.assertEqual((rows[1]['codigo_muestra'],rows[1]['dilucion'],rows[1]['en_rango_contable']),('M-002','10^-1','si'))
            self.assertEqual(rows[0]['ufc'],'')

    def test_date_saved_in_result_wins_over_file_date(self):
        # Copiar o restaurar la carpeta cambia la fecha de los archivos; la fecha del JSON no cambia.
        fake_analysis(self.api,A,10,analyzed_at='2026-01-05T09:00:00')
        fake_analysis(self.api,B,20,age=3600)
        with self.client() as c:
            items=c.get('/history').json()
            self.assertEqual([i['analysis_id'] for i in items],[B,A])
            self.assertEqual(items[1]['analyzed_at'],'2026-01-05T09:00:00')
            self.assertEqual(c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1}).json()['analyzed_at'],'2026-01-05T09:00:00')

    def test_thumbnail_is_small_and_cached(self):
        fake_analysis(self.api,A,5)
        with self.client() as c:
            r=c.get(f'/results/{A}/miniatura.jpg');self.assertEqual(r.status_code,200)
            with Image.open(io.BytesIO(r.content)) as im:self.assertLessEqual(max(im.size),360)
        self.assertTrue((self.api/A/'miniatura.jpg').is_file())

    def test_errors_and_access_key(self):
        fake_analysis(self.api,A,45)
        with self.client(key='k') as c:
            self.assertEqual(c.get('/api/history').status_code,401)
            self.assertEqual(c.get('/api/history/csv?clave=k').status_code,200)
            h={'X-Clave':'k'}
            self.assertEqual(c.post(f'/results/{B}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1},headers=h).status_code,404)
            self.assertEqual(c.post('/results/xyz/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1},headers=h).status_code,404)
            self.assertEqual(c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':0},headers=h).status_code,422)
            self.assertEqual(c.post(f'/results/{A}/ufc',json={'sample':{'code':'M-TEST','sample_type':'Agua','responsible':'Ana'},'exponent':1,'volume_ml':.1,'count_min':300,'count_max':30},headers=h).status_code,422)
            self.assertEqual(c.get(f'/results/{A}/historial.jsonl',headers=h).status_code,404)


    def test_required_sample_and_review_csv_without_ufc(self):
        fake_analysis(self.api,A,12)
        with self.client() as c:
            for sample in (None, {}, {'code':'  ','sample_type':'Agua'}, {'code':'X','sample_type':' '}):
                for endpoint,body in [('review',{'centers':[]}),('ufc',{'exponent':1,'volume_ml':1})]:
                    if sample is not None:body['sample']=sample
                    self.assertEqual(c.post(f'/results/{A}/{endpoint}',json=body).status_code,422)
            sample={'code':' M-01 ','sample_type':'Agua de riego','responsible':'Valeria','notes':'Primera, prueba'}
            r=c.post(f'/results/{A}/review',json={'centers':[{'x':10,'y':10}],'sample':sample})
            self.assertEqual(r.status_code,200,r.text)
            row=list(csv.DictReader(io.StringIO(c.get('/history/csv').content.decode('utf-8-sig'))))[0]
            self.assertEqual((row['codigo_muestra'],row['tipo_muestra'],row['responsable'],row['observaciones']),('M-01','Agua de riego','Valeria','Primera, prueba'))
            self.assertNotIn('placa_duplicada',row);self.assertNotIn('advertencias',row)
            self.assertEqual(row['ufc'],'')
            c.post(f'/results/{A}/ufc',json={'exponent':1,'volume_ml':1,'sample':sample})
            sample['code']='M-02';sample['notes']='Nueva observación'
            c.post(f'/results/{A}/review',json={'centers':[],'sample':sample})
            row=list(csv.DictReader(io.StringIO(c.get('/history/csv').content.decode('utf-8-sig'))))[0]
            self.assertEqual((row['codigo_muestra'],row['observaciones']),('M-02','Nueva observación'))

    def test_review_preserves_radius_and_kind(self):
        fake_analysis(self.api,A,12)
        with self.client() as c:
            point={'x':50,'y':60,'r':23.5,'kind':'manual'}
            body={'centers':[point],'sample':{'code':'M','sample_type':'Agua'}}
            response=c.post(f'/results/{A}/review',json=body)
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(c.get(f'/results/{A}/revision.json').json()['centers'],[point])
            body['centers'][0]['r']=-1
            self.assertEqual(c.post(f'/results/{A}/review',json=body).status_code,422)

    def test_same_interface_localhost_and_network(self):
        for host in ('localhost','192.168.1.10'):
            with TestClient(create_app(output=self.api,samples_db=self.root/'m.db',use_hybrid=False),base_url=f'http://{host}') as c:
                page=c.get('/')
                self.assertEqual(page.status_code,200)
                self.assertIn('ÑawIA',page.text)
                self.assertEqual(page.headers['cache-control'],'no-cache')
                self.assertEqual(c.get('/api/history').status_code,200)

if __name__=='__main__':unittest.main(verbosity=2)
