"""IDs cortos persistentes, compatibles con analisis anteriores."""
import tempfile,unittest,sqlite3
from contextlib import closing
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from app.services.results import ResultStore,SequenceExhausted,_valid_id

class SequenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'results'
    def tearDown(self):self.tmp.cleanup()
    def test_starts_at_one_and_survives_restart_and_removed_folder(self):
        first,folder=ResultStore(self.root).new_folder()
        self.assertEqual(first,'A0001');self.assertTrue(folder.is_dir())
        folder.rmdir()
        self.assertEqual(ResultStore(self.root).new_folder()[0],'A0002')
    def test_concurrent_stores_do_not_reuse_identifiers(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            ids=list(pool.map(lambda _:ResultStore(self.root).new_folder()[0],range(24)))
        self.assertEqual(sorted(ids),[f'A{i:04d}' for i in range(1,25)])
    def test_recovers_from_existing_directories_and_rolls_over(self):
        (self.root/'A9999').mkdir(parents=True)
        (self.root/('a'*32)).mkdir()
        self.assertEqual(ResultStore(self.root).new_folder()[0],'B0001')
        self.assertTrue(_valid_id('a'*32));self.assertTrue(_valid_id('B0001'))
        for value in ('../A0001','A00001','a0001','A0001/',''):
            self.assertFalse(_valid_id(value))
    def test_collision_and_exhaustion_do_not_overwrite(self):
        store=ResultStore(self.root);store.new_folder()
        (self.root/'A0002').mkdir()
        self.assertEqual(store.new_folder()[0],'A0003')
        with closing(sqlite3.connect(self.root/'secuencia.sqlite3')) as db, db:
            db.execute('UPDATE counter SET value=?',(26*9999,))
        with self.assertRaises(SequenceExhausted):store.new_folder()
