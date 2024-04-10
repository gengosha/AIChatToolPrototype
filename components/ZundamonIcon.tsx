import Image from 'next/image';
import React from 'react';

// Propsの型定義
interface ImageComponentProps {
  number: string | undefined;
}

const ImageComponent: React.FC<ImageComponentProps> = (props) => {
  const { number } = props;

  // 本来はnumberを使って何かしらの処理をするかもしれません
  const parsedNumber = () => {
    console.log("number: ", number)
    if(number !== undefined) {
      const match = number.match(/\{ select: (\d+) \}/);
      const selectValue = match ? parseInt(match[1], 10) : null;
      return selectValue
    }
  };

  return (
    <div>
      <Image
        src={`/zundamon/${parsedNumber() || "19"}.png`}
        alt="Description of example1"
        width={100}
        height={100}
      />
    </div>
  );
};

export default ImageComponent;
