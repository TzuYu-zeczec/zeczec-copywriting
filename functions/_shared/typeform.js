/**
 * Typeform API 操作模組
 * 用於自動建立問卷
 */

const TYPEFORM_API = 'https://api.typeform.com';

/**
 * 建立 Typeform 問卷
 * @param {object} env - 環境變數（需含 TYPEFORM_API_TOKEN）
 * @param {object} form - 問卷結構
 * @param {string} form.title - 問卷標題
 * @param {Array} form.fields - 問題陣列
 * @returns {{ formId: string, formUrl: string, editUrl: string }}
 */
export async function createTypeform(env, form) {
  const token = env.TYPEFORM_API_TOKEN;
  if (!token) throw new Error('未設定 Typeform API Token');

  // Build Typeform API payload
  // 注意：language 只接受 'zh'，不接受 'zh-TW'（否則 NOT_ALLOWED_VALUE）
  const payload = {
    title: form.title,
    settings: {
      language: 'zh',
      progress_bar: 'percentage',
      is_public: true,
      show_progress_bar: true
    },
    fields: form.fields.map(convertField)
  };

  // 收集需要在後台手動開啟「複選」的題目（API 不支援設定 allow_multiple_selection）
  const needsMultiple = form.fields
    .filter(f => f.type === 'multiple_choice' && f.multiple)
    .map(f => f.title);

  // Add welcome screen if provided
  if (form.welcome) {
    payload.welcome_screens = [{
      title: form.welcome.title,
      properties: {
        description: form.welcome.description || '',
        show_button: true,
        button_text: form.welcome.button_text || '開始填寫'
      }
    }];
  }

  // Add thank you screen if provided
  if (form.thankyou) {
    payload.thankyou_screens = [{
      title: form.thankyou.title,
      properties: {
        description: form.thankyou.description || '',
        show_button: !!form.thankyou.button_url,
        button_text: form.thankyou.button_text || '',
        button_mode: form.thankyou.button_url ? 'redirect' : 'default_redirect',
        redirect_url: form.thankyou.button_url || ''
      }
    }];
  }

  const res = await fetch(`${TYPEFORM_API}/forms`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Typeform API 錯誤: ${res.status} ${err.substring(0, 300)}`);
  }

  const result = await res.json();
  return {
    formId: result.id,
    formUrl: result._links?.display || `https://form.typeform.com/to/${result.id}`,
    editUrl: `https://admin.typeform.com/form/${result.id}/create`,
    needsMultiple
  };
}

/**
 * 將我們的問題格式轉換為 Typeform API 格式
 */
function convertField(field) {
  const base = {
    title: field.title,
    properties: {}
  };

  // Add description if present
  if (field.description) {
    base.properties.description = field.description;
  }

  switch (field.type) {
    case 'short_text':
      return { ...base, type: 'short_text', validations: { required: !!field.required } };

    case 'long_text':
      return { ...base, type: 'long_text', validations: { required: !!field.required } };

    case 'multiple_choice':
      // 不送 allow_multiple_selection — API 會拒絕；複選需在後台手動開啟（見 needsMultiple）
      return {
        ...base,
        type: 'multiple_choice',
        properties: {
          ...base.properties,
          choices: (field.choices || []).map(c => ({ label: c })),
          randomize: false,
          allow_other_choice: !!field.allow_other
        },
        validations: { required: !!field.required }
      };

    case 'rating':
      return {
        ...base,
        type: 'rating',
        properties: {
          ...base.properties,
          steps: field.steps || 5,
          shape: field.shape || 'star'
        },
        validations: { required: !!field.required }
      };

    case 'opinion_scale':
      return {
        ...base,
        type: 'opinion_scale',
        properties: {
          ...base.properties,
          steps: field.steps || 10,
          start_at_one: true,
          labels: {
            left: field.label_left || '非常不同意',
            right: field.label_right || '非常同意'
          }
        },
        validations: { required: !!field.required }
      };

    case 'yes_no':
      return { ...base, type: 'yes_no', validations: { required: !!field.required } };

    case 'email':
      return { ...base, type: 'email', validations: { required: !!field.required } };

    case 'phone_number':
      return {
        ...base,
        type: 'phone_number',
        properties: { ...base.properties, default_country_code: field.country_code || 'TW' },
        validations: { required: !!field.required }
      };

    case 'number':
      return { ...base, type: 'number', validations: { required: !!field.required } };

    case 'statement':
      return {
        ...base,
        type: 'statement',
        properties: {
          ...base.properties,
          button_text: field.button_text || '繼續'
        }
      };

    case 'picture_choice':
      return {
        ...base,
        type: 'picture_choice',
        properties: {
          ...base.properties,
          choices: (field.choices || []).map(c => ({ label: c })),
          allow_multiple_selection: !!field.multiple
        },
        validations: { required: !!field.required }
      };

    default:
      // Default to short_text for unknown types
      return { ...base, type: 'short_text', validations: { required: !!field.required } };
  }
}
