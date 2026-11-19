/* 필투두 동기화 설정(Supabase) — 필보드와 같은 계정으로 로그인한다.
   이 키는 공개용 키라 페이지에 넣어도 된다 — 할 일은 로그인한 본인 것만 읽고 쓸 수 있다(RLS). */
window.PT_CONFIG = {
  url: "https://ykobggucsqjdqknejuvc.supabase.co",
  key: "sb_publishable_GcGB2svxfKVri1HTkti05g_3xRkTesb",
  helper: "http://127.0.0.1:8790"   // PC 도우미(server.py) 주소 — 폴더 사진·HTML 열기
};
