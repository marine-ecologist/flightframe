// Some browser/file-provider combinations reject Blob.text() while FileReader works.
export async function readTextFile(file,Reader=globalThis.FileReader){
  try{return await file.text();}
  catch(firstError){
    if(!Reader)throw firstError;
    return new Promise((resolve,reject)=>{
      const reader=new Reader();
      reader.onload=()=>resolve(String(reader.result??''));
      reader.onerror=()=>reject(reader.error||firstError);
      reader.onabort=()=>reject(new Error('File reading was cancelled. Select the files again.'));
      reader.readAsText(file);
    });
  }
}
