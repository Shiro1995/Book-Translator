import { normalizeLookupText } from "../utils/selectionNormalization";

interface MinhqndMeaning {
  definition?: string;
  definition_lang?: string;
  example?: string | null;
  pos?: string | null;
  sub_pos?: string | null;
  source?: string | null;
}

interface MinhqndPronunciation {
  ipa?: string;
  region?: string;
}

interface MinhqndLookupResultEntry {
  lang_code?: string;
  meanings?: MinhqndMeaning[];
  pronunciations?: MinhqndPronunciation[];
}

interface MinhqndLookupResponse {
  exists?: boolean;
  word?: string;
  results?: MinhqndLookupResultEntry[];
}

export interface VietnameseVietnameseMeaning {
  definition: string;
  definitionLang: string;
  example?: string;
  partOfSpeech?: string;
  subPartOfSpeech?: string;
  source?: string;
}

export interface VietnameseVietnamesePronunciation {
  ipa: string;
  region?: string;
}

export interface VietnameseVietnameseDictionaryResult {
  status: "success" | "empty";
  source: "minhqnd";
  word: string;
  meanings: VietnameseVietnameseMeaning[];
  pronunciations: VietnameseVietnamesePronunciation[];
  note?: string;
}

const vietnameseDictionaryCache = new Map<string, VietnameseVietnameseDictionaryResult>();

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError() {
  return new DOMException("Aborted", "AbortError");
}

function buildEmptyResult(word: string): VietnameseVietnameseDictionaryResult {
  return {
    status: "empty",
    source: "minhqnd",
    word,
    meanings: [],
    pronunciations: [],
    note: "Chưa tìm thấy định nghĩa Việt-Việt cho từ/cụm này.",
  };
}

export function clearVietnameseVietnameseDictionaryCacheForTests() {
  vietnameseDictionaryCache.clear();
}

export async function lookupVietnameseVietnameseDictionary(
  word: string,
  options?: { signal?: AbortSignal },
): Promise<VietnameseVietnameseDictionaryResult> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  const normalizedWord = normalizeLookupText(word);
  if (!normalizedWord) {
    return buildEmptyResult(word.trim());
  }

  if (vietnameseDictionaryCache.has(normalizedWord)) {
    return vietnameseDictionaryCache.get(normalizedWord)!;
  }

  const endpoint = String(
    import.meta.env.VITE_MINHQND_VI_DICT_URL ?? "https://dict.minhqnd.com/api/v1/lookup",
  ).trim();
  const url = new URL(endpoint);
  url.searchParams.set("word", normalizedWord);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal: options?.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error("Không thể kết nối tới từ điển Việt-Việt.");
  }

  if (!response.ok) {
    throw new Error(`Từ điển Việt-Việt trả lỗi (${response.status}).`);
  }

  const payload = (await response.json()) as MinhqndLookupResponse;
  if (!payload.exists || !payload.results || payload.results.length === 0) {
    const emptyResult = buildEmptyResult(payload.word?.trim() || normalizedWord);
    vietnameseDictionaryCache.set(normalizedWord, emptyResult);
    return emptyResult;
  }

  const bestEntry = payload.results.find((item) => item.lang_code === "vi") ?? payload.results[0];
  const mappedMeanings =
    bestEntry?.meanings
      ?.flatMap((item) => {
        const definition = item.definition?.trim();
        if (!definition) {
          return [];
        }

        const normalizedMeaning: VietnameseVietnameseMeaning = {
          definition,
          definitionLang: item.definition_lang?.trim() || "vi",
        };
        const normalizedExample = item.example?.trim();
        const normalizedPartOfSpeech = item.pos?.trim();
        const normalizedSubPartOfSpeech = item.sub_pos?.trim();
        const normalizedSource = item.source?.trim();

        if (normalizedExample) {
          normalizedMeaning.example = normalizedExample;
        }
        if (normalizedPartOfSpeech) {
          normalizedMeaning.partOfSpeech = normalizedPartOfSpeech;
        }
        if (normalizedSubPartOfSpeech) {
          normalizedMeaning.subPartOfSpeech = normalizedSubPartOfSpeech;
        }
        if (normalizedSource) {
          normalizedMeaning.source = normalizedSource;
        }

        return [normalizedMeaning];
      }) ?? [];

  const vietnameseOnlyMeanings = mappedMeanings.filter((item) => item.definitionLang === "vi");
  const selectedMeanings = (vietnameseOnlyMeanings.length > 0 ? vietnameseOnlyMeanings : mappedMeanings).slice(0, 6);

  const pronunciations =
    bestEntry?.pronunciations
      ?.flatMap((item) => {
        const ipa = item.ipa?.trim();
        if (!ipa) {
          return [];
        }

        const normalizedPronunciation: VietnameseVietnamesePronunciation = {
          ipa,
        };
        const normalizedRegion = item.region?.trim();
        if (normalizedRegion) {
          normalizedPronunciation.region = normalizedRegion;
        }

        return [normalizedPronunciation];
      })
      .slice(0, 4) ?? [];

  const result: VietnameseVietnameseDictionaryResult =
    selectedMeanings.length > 0
      ? {
          status: "success",
          source: "minhqnd",
          word: payload.word?.trim() || normalizedWord,
          meanings: selectedMeanings,
          pronunciations,
        }
      : buildEmptyResult(payload.word?.trim() || normalizedWord);

  vietnameseDictionaryCache.set(normalizedWord, result);
  return result;
}
