# Session Notes

## Mục tiêu app

App dùng để:

- Tải sách/PDF/DOCX lên.
- Tách nội dung theo từng trang.
- Gửi từng trang qua backend `server.ts`.
- Backend gọi sang n8n webhook để xử lý dịch.
- Nhận kết quả dịch trả về để xem, sửa, dịch tự động và xuất PDF.

Luồng hiện tại:

`Frontend -> /api/translate -> server.ts -> n8n webhook -> model/API dịch -> response về app`

## Các thay đổi đã làm

### 1. Đổi luồng dịch sang n8n webhook

- App không gọi trực tiếp model từ frontend.
- Frontend gọi `POST /api/translate`.
- `server.ts` đóng vai trò proxy sang n8n webhook.
- Có hỗ trợ `Authorization` header qua token cấu hình.
- Đã debug các case:
  - webhook test URL vs production URL
  - `404` do webhook chưa active/public
  - `403 Authorization data is wrong!`
  - `502 Bad Gateway` khi backend/webhook lỗi

Ghi nhớ:

- `webhook-test` chỉ dùng được khi node đang `Listen for test event`.
- `webhook` production chỉ dùng được sau khi flow đã publish/activate.

### 2. PDF/DOCX đọc file

- Trước đó có issue với package worker PDF.
- Đã chuyển phần xử lý file để tránh phụ thuộc vào package cũ bị thiếu/không tìm thấy.
- `src/services/fileService.ts` là file chính cần kiểm tra nếu có lỗi parse sách.

### 3. Sửa tiếng Việt có dấu trên giao diện

- Có giai đoạn app bị mất dấu tiếng Việt sau khi sửa.
- Đã phục hồi text tiếng Việt có dấu trong UI.
- Tuy nhiên vẫn cần cảnh giác với lỗi encoding từ nguồn dịch hoặc từ response n8n.

### 4. Session dịch được giữ lại

Trong `src/App.tsx` đã thêm cơ chế giữ phiên làm việc:

- Bấm `Đóng` không xóa sách đang dịch.
- Có thể quay lại màn add sách rồi mở lại phiên cũ.
- Dùng `localStorage` để lưu draft.

Key hiện dùng:

- `book-translator:draft-book`
- `book-translator:draft-ui`

### 5. Ẩn/hiện thanh settings

- Đã thêm nút đóng/mở panel settings bên phải.
- Trên desktop có thể ẩn panel để tập trung đọc.

### 6. Responsive mobile

Đã chỉnh `src/App.tsx` để dùng tốt hơn trên điện thoại:

- Header và nút upload không còn bị che.
- Các nút wrap tốt hơn trên màn nhỏ.
- Sidebar desktop được ẩn trên mobile.
- Thêm drawer mobile cho:
  - Danh sách trang
  - Cài đặt dịch

Trạng thái liên quan:

- `isMobilePagesOpen`
- `isMobileSettingsOpen`
- `isSettingsOpen`

### 7. Auto translate

Đã thêm:

- Option `Auto bắt đầu từ trang`.
- Auto translate bỏ qua trang đã dịch rồi.

Rule skip hiện tại:

- Trang có `status === "completed"` hoặc
- Có `translatedText` khác rỗng

### 8. Xuất PDF

Đã thử nhiều hướng:

#### Giai đoạn 1

- Dùng `jsPDF` text thuần.
- Bị lỗi font/Unicode tiếng Việt.

#### Giai đoạn 2

- Dùng `doc.html(...)`.
- Có lúc sinh PDF trắng.
- Có lúc lỗi cắt chữ hoặc lỗi rendering.

#### Giai đoạn 3

- Chuyển sang hướng `HTML hidden -> html2canvas -> addImage vào PDF`.
- Mục tiêu là giữ đúng Unicode tiếng Việt nhờ browser render trước rồi mới chụp ảnh.

Các yêu cầu đã áp vào export:

- Chỉ xuất các trang đã dịch.
- Trang chưa dịch thì bỏ qua.
- Đánh lại số thứ tự trang export.
- Có trạng thái `Đang xuất...`.
- Đã cố xử lý chống cắt chữ giữa hai trang.
- Đã bỏ nhãn kiểu `Trang 1`, `Trang 2` trong nội dung export.

Tuy nhiên:

- Export PDF vẫn là vùng còn nhạy cảm.
- Đã từng xuất hiện:
  - trang trắng
  - split chữ chưa triệt để
  - blank page 2
  - page break chưa đẹp

Nếu sửa tiếp, ưu tiên kiểm tra lại toàn bộ logic `exportPDF` trong `src/App.tsx`.

## Các vấn đề kỹ thuật đã debug

### 1. Frontend gọi `/api/translate` là đúng

User từng thắc mắc:

- Vì sao app gọi `http://localhost:3000/api/translate` thay vì gọi thẳng webhook

Giải thích:

- Frontend chỉ gọi backend local/app server.
- `server.ts` mới là nơi gọi webhook n8n.
- Làm vậy để:
  - ẩn token
  - kiểm soát request/response
  - thêm fallback, validate, normalize

### 2. Cách kiểm tra đã gọi webhook chưa

Có thể kiểm tra ở:

- Network tab của browser:
  - request `POST /api/translate`
- Log server `server.ts`
- Output execution trong n8n
- Response body từ `/api/translate`

### 3. Lỗi test URL và production URL của n8n

Đã xác nhận:

- `webhook-test/send-message`
  - chỉ chạy khi bấm `Listen for test event`
- `webhook/send-message`
  - chỉ chạy khi workflow đã public/active

### 4. Lỗi Authorization

Đã gặp case:

- `n8n webhook returned an error | Authorization data is wrong! | status=403`

Nguyên nhân:

- Header gửi từ app/server không khớp credential của n8n webhook.

### 5. Lỗi response format của n8n

App mong chờ response dạng dễ đọc được, ví dụ tối thiểu:

```json
{
  "translatedText": "..."
}
```

Nếu n8n trả nguyên object theo format kiểu chat completion:

```json
{
  "choices": [
    {
      "message": {
        "content": "..."
      }
    }
  ]
}
```

thì cần `Respond to Webhook` map lại cho app đọc được.

### 6. Lỗi tiếng Việt mất dấu sau khi dịch

Có trường hợp text trả về dạng:

- tiếng Việt không dấu hoặc thiếu dấu rất nặng
- mojibake/encoding sai

Đã thêm logic trong `server.ts`:

- ép instruction mạnh hơn nếu `targetLang` là Vietnamese
- detect output tiếng Việt có tỷ lệ dấu quá thấp
- nếu nghi ngờ lỗi kỹ thuật, trả lỗi:

```json
{
  "code": "E_VIETNAMESE_DIACRITICS"
}
```

Lưu ý quan trọng:

- Đây là lỗi kỹ thuật/pipeline/encoding, không nên hiểu đơn thuần là lỗi model.
- Nếu muốn xử lý chuẩn hơn nữa, cần cập nhật thêm `src/services/translationService.ts` để không fallback model một cách mù quáng khi gặp `E_VIETNAMESE_DIACRITICS`.

### 7. Fallback model

User muốn:

- model lấy từ app bắn sang n8n
- nếu fail thì fallback model khác

Ý tưởng đã bàn:

- model đầu tiên do app gửi
- nếu lỗi có thể thử:
  - `gemini-2.5-pro`
  - rồi `gemini-2.5-flash`

Nhưng cần phân biệt:

- lỗi model thật
- lỗi kỹ thuật do n8n/encoding/rate limit/response parsing

không nên gom tất cả thành fallback model.

### 8. Lỗi deploy VPS

Khi deploy, app trên web báo:

- `Translation failed | model=gemini-2.5-flash`

Sau khi kiểm tra thì lỗi thật là:

- Nginx `502 Bad Gateway`

Log đã thấy:

```text
connect() failed (111: Unknown error) while connecting to upstream
upstream: "http://127.0.0.1:8000/api/translate"
```

Kết luận:

- Nginx đang proxy `/api` sang `127.0.0.1:8000`
- nhưng backend thực tế không chạy ở đó

Cần đồng bộ:

- port Node backend
- `proxy_pass` của Nginx

## Cách build/chạy đã dùng

Local đã từng chạy ở:

- `localhost:3000`
- `localhost:3001`

Có thời điểm:

- 3000 hiện trang lỗi CSS/do serve khác luồng
- 3001 lên UI đúng

Cần phân biệt rõ:

- port FE dev
- port backend/proxy

## Các file quan trọng

- `src/App.tsx`
  - UI chính
  - mobile responsive
  - auto translate
  - export PDF
  - session draft
- `server.ts`
  - API `/api/translate`
  - proxy sang n8n
  - validate/normalize response
- `src/services/translationService.ts`
  - gọi `/api/translate`
  - retry/fallback logic
- `src/services/fileService.ts`
  - đọc/tách file PDF/DOCX
- `.env.example`
  - biến môi trường mẫu

## Các điểm còn cần xem lại

### Ưu tiên cao

- Rà lại export PDF để tránh:
  - blank page
  - page split xấu
  - mất nội dung ở điểm ngắt trang
- Sửa `translationService.ts` để phân biệt lỗi kỹ thuật `E_VIETNAMESE_DIACRITICS`
- Chuẩn hóa format response từ n8n về app
- Thêm logging rõ hơn từ FE -> backend -> n8n

### Cải tiến nên làm tiếp

- Queue/batch translate
- Resume job bền hơn ở server hoặc database
- Filter trang:
  - chưa dịch
  - lỗi
  - đã dịch
  - đã sửa tay
- Glossary theo project/sách
- Preset prompt dịch
- OCR cho PDF scan
- Export nhiều định dạng hơn

## Ghi chú cho n8n

Nếu dùng HTTP Request/LLM node trong n8n:

- body gửi sang model nên lấy từ payload app, không hardcode cứng
- response cuối cùng trả về app nên tối giản, ví dụ:

```json
{
  "translatedText": "nội dung đã dịch"
}
```

Nếu lỗi, nên trả JSON rõ ràng:

```json
{
  "error": "mô tả lỗi",
  "code": "mã lỗi",
  "status": 429
}
```

Để app/backend dễ phân loại:

- rate limit
- auth
- webhook inactive
- parsing error
- encoding/diacritics issue

## Trạng thái hiện tại

App đã có:

- đọc sách
- dịch thủ công từng trang
- dịch tự động từ trang chỉ định
- bỏ qua trang đã dịch
- responsive mobile cơ bản
- giữ session đang dịch
- export PDF ở mức dùng được

Nhưng còn 2 khu vực cần coi là chưa chốt:

- export PDF
- chuẩn hóa response/lỗi từ n8n

