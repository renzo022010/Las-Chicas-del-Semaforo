"""Archivos de cada analisis. La prediccion automatica no se modifica; la revision humana y el calculo de UFC se guardan aparte.

Cada analisis vive en resultados/api/<id>/ (foto, conteo, revision.json, ufc.json). Ademas, historial.jsonl registra cada
calculo de UFC guardado, sin sobrescribir los anteriores, para poder auditar cambios."""
from datetime import datetime
from pathlib import Path
import csv,io,json,threading,re,sqlite3
from contextlib import closing
from PIL import Image
from app.config import RESULT_FILES
from app.schemas.results import PlateUfc
from app.schemas.samples import Dilution,Plate,UfcInput
from app.services.ufc import calcular_ufc

class ResultNotFound(Exception):pass
class SequenceExhausted(Exception):pass

THUMB_SIDE=360
HISTORY_LOG='historial.jsonl'
CSV_COLUMNS=(('fecha_analisis','analyzed_at'),('id_analisis','analysis_id'),('codigo_muestra','code'),('tipo_muestra','sample_type'),
    ('responsable','responsible'),('colonias_automatico','automatic_count'),('colonias_revisado','reviewed_count'),
    ('colonias_usadas','count'),('dilucion','dilution'),('volumen_sembrado_ml','volume_ml'),
    ('unidad','unit'),('ufc','value'),('ufc_reportado','reported'),('log10_ufc','log10'),('en_rango_contable','in_range'),
    ('observaciones','notes'),('ufc_guardado','saved_at'))

def _valid_id(analysis_id):
    return bool(re.fullmatch(r'[A-Z][0-9]{4}|[0-9a-f]{32}',analysis_id))

def _iso(timestamp):return datetime.fromtimestamp(timestamp).isoformat(timespec='seconds')

def _analyzed_at(original,path):
    """Fecha guardada en el resultado; los analisis anteriores a ese campo usan la fecha del archivo."""
    return original.get('analyzed_at') or _iso(path.stat().st_mtime)

class ResultStore:
    def __init__(self,root):
        self.root=Path(root);self._lock=threading.Lock()

    def new_folder(self):
        # Reserva persistente compartida entre procesos y dispositivos; nunca reutiliza IDs.
        self.root.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(self.root/'secuencia.sqlite3',timeout=30)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)')
            row=db.execute('SELECT value FROM counter WHERE id=1').fetchone()
            if row is None:
                existing=[(ord(p.name[0])-ord('A'))*9999+int(p.name[1:]) for p in self.root.iterdir()
                          if re.fullmatch(r'[A-Z][0-9]{4}',p.name)]
                value=max(existing,default=0)
            else:value=row[0]
            while value<26*9999:
                value+=1
                letter,number=divmod(value-1,9999)
                ident=f'{chr(ord("A")+letter)}{number+1:04d}'
                folder=self.root/ident
                try:folder.mkdir()
                except FileExistsError:continue
                db.execute('INSERT OR REPLACE INTO counter (id,value) VALUES (1,?)',(value,))
                return ident,folder
            raise SequenceExhausted('Se agotaron los identificadores disponibles hasta Z9999')

    def path(self,analysis_id,name):
        if not _valid_id(analysis_id) or name not in RESULT_FILES:raise ResultNotFound
        path=self.root/analysis_id/name
        if name=='miniatura.jpg' and not path.is_file():self._make_thumbnail(analysis_id,path)
        if not path.is_file():raise ResultNotFound
        return path

    def _make_thumbnail(self,analysis_id,path):
        """Miniatura para el historial: la foto original puede pesar varios MB."""
        original=self.root/analysis_id/'foto_original.jpg'
        with self._lock:
            if path.is_file() or not original.is_file():return
            with Image.open(original) as image:
                image.thumbnail((THUMB_SIDE,THUMB_SIDE))
                image.convert('RGB').save(path,'JPEG',quality=82)

    def _read(self,analysis_id,name):
        return json.loads(self.path(analysis_id,name).read_text(encoding='utf-8'))

    def _read_optional(self,analysis_id,name):
        try:return self._read(analysis_id,name)
        except ResultNotFound:return None

    def save_review(self,analysis_id,review):
        original=self._read(analysis_id,'foto_resultado.json')
        w=original['image_size']['width'];h=original['image_size']['height']
        if any(p.x>=w or p.y>=h for p in review.centers):raise ValueError('Centro fuera de imagen')
        record={'automatic_count':original['count'],'reviewed_count':len(review.centers),**review.model_dump(),
                'review_type':'human_submitted_centers_not_model_prediction'}
        with self._lock:
            (self.root/analysis_id/'revision.json').write_text(json.dumps(record,indent=2,ensure_ascii=False),encoding='utf-8')
            self._save_sample(analysis_id,review.sample)
        return record

    def _save_sample(self,analysis_id,sample):
        (self.root/analysis_id/'muestra.json').write_text(sample.model_dump_json(indent=2),encoding='utf-8')

    def save_ufc(self,analysis_id,data:PlateUfc):
        """Calcula UFC con el conteo guardado de esta placa (revisado si existe) y lo deja junto a la foto y en el historial."""
        original=self._read(analysis_id,'foto_resultado.json')
        review=self._read_optional(analysis_id,'revision.json')
        count=review['reviewed_count'] if review else original['count']
        dilution=Dilution(exponent=data.exponent,volume_ml=data.volume_ml,
                          plate_a=Plate(count=count,analysis_id=analysis_id),plate_b=Plate(count=data.duplicate_count))
        result=calcular_ufc(UfcInput(dilutions=[dilution],unit=data.unit,count_min=data.count_min,count_max=data.count_max))
        record={'analysis_id':analysis_id,'saved_at':datetime.now().isoformat(timespec='seconds'),
                'analyzed_at':_analyzed_at(original,self.path(analysis_id,'foto_resultado.json')),
                'count':count,'count_source':'revisado' if review else 'automatico','automatic_count':original['count'],
                'reviewed_count':review['reviewed_count'] if review else None,**data.model_dump(),
                'formula':f'UFC/{data.unit} = promedio de colonias x 10^{data.exponent} / {data.volume_ml:g} mL','result':result}
        with self._lock:
            self._save_sample(analysis_id,data.sample)
            (self.root/analysis_id/'ufc.json').write_text(json.dumps(record,indent=2,ensure_ascii=False),encoding='utf-8')
            with open(self.root/HISTORY_LOG,'a',encoding='utf-8') as log:log.write(json.dumps(record,ensure_ascii=False)+'\n')
        return record

    def history(self,limit=500):
        """Todos los analisis guardados, del mas reciente al mas antiguo, con su revision y su UFC si existen."""
        if not self.root.is_dir():return []
        out=[]
        for path in self.root.glob('*/foto_resultado.json'):
            ident=path.parent.name
            if not _valid_id(ident):continue
            try:
                original=self._read(ident,'foto_resultado.json')
                review=self._read_optional(ident,'revision.json')
                ufc=self._read_optional(ident,'ufc.json')
                summary=ufc and {'value':ufc['result']['value'],'reported':ufc['result'].get('reported'),
                                 'unit':ufc['result']['unit'],'in_range':ufc['result']['in_range'],'exponent':ufc['exponent'],
                                 'volume_ml':ufc['volume_ml'],'count':ufc['count'],'count_source':ufc['count_source'],
                                 'duplicate_count':ufc['duplicate_count'],'detection_limit':ufc['result'].get('detection_limit'),
                                 'log10':ufc['result'].get('log10'),'warnings':ufc['result']['warnings'],
                                 'sample':ufc['sample'],'saved_at':ufc['saved_at']}
                sample=self._read_optional(ident,'muestra.json') or (review or {}).get('sample') or (ufc or {}).get('sample') or {}
                analyzed_at=_analyzed_at(original,path)
            except (OSError,ResultNotFound,ValueError,KeyError,TypeError):continue  # archivo borrado, corrupto o a medio escribir
            out.append({'analysis_id':ident,'analyzed_at':analyzed_at,'automatic_count':original.get('count'),
                        'reviewed_count':review['reviewed_count'] if review else None,'ufc':summary,'sample':sample})
        out.sort(key=lambda item:item['analyzed_at'],reverse=True)
        return out[:limit]

    def history_csv(self):
        """Historial como CSV (UTF-8 con BOM para que Excel respete las tildes)."""
        buffer=io.StringIO()
        writer=csv.writer(buffer)
        writer.writerow([name for name,_ in CSV_COLUMNS])
        for item in self.history(limit=100000):
            ufc=item['ufc'] or {}
            sample=item.get('sample') or ufc.get('sample') or {}
            row={**item,**{k:v for k,v in ufc.items() if k!='sample'},**sample,
                 'dilution':f"10^-{ufc['exponent']}" if ufc else '','warnings':' | '.join(ufc.get('warnings') or []),
                 'in_range':('si' if ufc.get('in_range') else 'no') if ufc else ''}
            writer.writerow(['' if row.get(key) is None else row.get(key) for _,key in CSV_COLUMNS])
        return '﻿'+buffer.getvalue()
