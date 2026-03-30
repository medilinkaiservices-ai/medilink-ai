import { useEffect, useState } from "react";
import { getStorage, ref, getDownloadURL } from "firebase/storage";

export function useFirebaseImage(path) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!path) return;

    const storage = getStorage();
    const fileRef = ref(storage, path);

    getDownloadURL(fileRef)
      .then((downloadURL) => {
        setUrl(downloadURL);
      })
      .catch((err) => {
        console.error("Image load error:", err);
      });

  }, [path]);

  return url;
}