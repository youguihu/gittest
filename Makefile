#threadpoolCpp11:main.cpp ThreadPool.cpp
#	g++ -o threadpoolCpp11  main.cpp ThreadPool.cpp -lpthread

SRC = 1.txt
OBJ = $(SRC:.txt=.o)
$(shell echo $$OBJ)


test.txt :  2.txt 3.txt t.txt
	cat $(OBJ) 2.txt 3.txt t.txt > test.txt
	
#	注释
1.txt 2.txt 3.txt t.txt:
	cp 4.txt $@


	
